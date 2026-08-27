package com.busgo.server.service;

import com.busgo.server.dto.BusDto;
import com.busgo.server.entity.Bus;
import com.busgo.server.entity.User;
import com.busgo.server.exception.ResourceNotFoundException;
import com.busgo.server.mapper.BusMapper;
import com.busgo.server.repository.BusRepository;
import com.busgo.server.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class BusService {

    private final BusRepository busRepository;
    private final UserRepository userRepository;
    private final BusMapper busMapper;

    public List<BusDto> getAllBuses() {
        return busRepository.findAll().stream()
                .map(busMapper::toDto)
                .collect(Collectors.toList());
    }

    public BusDto getBusById(Long id) {
        Bus bus = busRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Bus not found with id " + id));
        return busMapper.toDto(bus);
    }

    public BusDto assignConductor(Long busId, Long conductorId) {
        Bus bus = busRepository.findById(busId)
                .orElseThrow(() -> new ResourceNotFoundException("Bus not found"));
        User conductor = userRepository.findById(conductorId)
                .orElseThrow(() -> new ResourceNotFoundException("Conductor not found"));

        bus.setConductor(conductor);
        return busMapper.toDto(busRepository.save(bus));
    }
}
